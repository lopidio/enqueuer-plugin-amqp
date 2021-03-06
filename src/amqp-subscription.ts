import * as amqp from 'amqp';
import {InputSubscriptionModel, Logger, MainInstance, Subscription, SubscriptionProtocol} from 'enqueuer';

export class AmqpSubscription extends Subscription {

    private readonly queueName: string;
    private readonly messageReceiverPromise: Promise<void>;
    private connection: any;
    private messageReceiverResolver?: Function;

    constructor(subscriptionAttributes: InputSubscriptionModel) {
        super(subscriptionAttributes);
        this['queueOptions'] = this.queueOptions || {};
        this.queueName = subscriptionAttributes.queueName || AmqpSubscription.createQueueName();
        this.messageReceiverPromise = new Promise((resolve) => this.messageReceiverResolver = resolve);
    }

    public static createQueueName(): string {
        const queueNameLength = 8;
        const possible: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let text = '';

        for (let i = queueNameLength; i > 0; --i) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }

        return text;
    }

    public receiveMessage(): Promise<void> {
        Logger.debug(`Amqp subscription registering receiveMessage resolver`);
        return this.messageReceiverPromise;
    }

    public subscribe(): Promise<void> {
        this.connection = amqp.createConnection(this.options);
        return new Promise((resolve, reject) => {
            this.connection.once('ready', () => {
                this.connectionReady(resolve, reject);
            });
            this.connection.on('error', (err: any) => reject(err));
        });
    }

    public async unsubscribe(): Promise<void> {
        if (this.connection) {
            this.connection.disconnect();
        }
        delete this.connection;
    }

    private connectionReady(resolve: any, reject: any) {
        this.connection.queue(this.queueName, this.queueOptions, (queue: any) => {
            queue.subscribe((message: any, headers: any, deliveryInfo: any) => this.gotMessage(message, headers, deliveryInfo));
            if (this.exchange && this.routingKey) {
                this.bind(queue, resolve);
            } else if (this.queueName) {
                Logger.debug(`Queue ${this.queueName} bound to the default exchange`);
                resolve();
            } else {
                reject(`Impossible to subscribe: ${this.queueName}:${this.exchange}:${this.routingKey}`);
            }
        });
    }

    private bind(queue: any, resolve: any) {
        Logger.debug(`Amqp subscription binding ${this.queueName} to exchange: ${this.exchange} and routingKey: ${this.routingKey}`);
        queue.bind(this.exchange, this.routingKey, () => {
            Logger.debug(`Queue ${this.queueName} bound`);
            resolve();
        });
    }

    private gotMessage(message: any, headers: any, deliveryInfo: any) {
        // if (this.messageReceiverPromiseResolver) {
            const result = {payload: message, headers: headers, deliveryInfo: deliveryInfo};
            this.executeHookEvent('onMessageReceived', result);
            this.messageReceiverResolver!();
        // } else {
        //     Logger.warning(`Queue '${this.queueName}' is not subscribed yet`);
        // }
    }

}

export function entryPoint(mainInstance: MainInstance): void {
    const amqp = new SubscriptionProtocol('amqp',
        (subscriptionModel: InputSubscriptionModel) => new AmqpSubscription(subscriptionModel),
        {
            homepage: 'https://github.com/enqueuer-land/enqueuer-plugin-amqp',
            libraryHomepage: 'https://github.com/postwait/node-amqp',
            description: 'Subscription to handle AMQP 0.9 protocol',
            schema: {
                attributes: {
                    options: {
                        description: 'Connection options',
                        type: 'object',
                        required: false,
                    },
                    queueOptions: {
                        type: 'object',
                        required: false,
                    },
                    queueName: {
                        description: 'Randomly generated when empty',
                        type: 'string',
                        required: false
                    },
                    exchange: {
                        description: 'Defaults to the default exchange when empty',
                        type: 'string',
                        required: false
                    },
                    routingKey: {
                        description: 'Defaults to the queue name when empty',
                        type: 'string',
                        required: false
                    },
                },
                hooks: {
                    onMessageReceived: {
                        arguments: {
                            payload: {},
                            headers: {},
                            deliveryInfo: {},
                        }
                    }
                }
            }
        })
        .addAlternativeName('amqp-0.9')
        .setLibrary('amqp') as SubscriptionProtocol;
    mainInstance.protocolManager.addProtocol(amqp);
}
