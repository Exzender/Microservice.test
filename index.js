// modules
const MicroMQ = require('micromq');
const Web3 = require('web3');
const MongoClient = require('mongodb').MongoClient;
const WebSocket = require('ws');

// constants
const ethWs = "wss://nodes.mewapi.io/ws/eth"; // eth node
const dburl = process.env.MONGODB_URL || 'mongodb://localhost:27017';
const dbName = 'ethcache';
const keepBlocks = 100;
const oneHourMs = 60 * 60 * 1000;

// globals
let mongoCloDb = null;
let mongoBlocksTable = null;
let mongoTxsTable = null;

// first init
const mongoClient = new MongoClient(dburl, { useUnifiedTopology: true });
const clients = new Map();
const web3 = new Web3(ethWs);
// Eth node subscription
const subscription = web3.eth.subscribe('newBlockHeaders', newEthBlock);

// WebSocket server
const ws = new WebSocket.Server({
    port: process.env.PORT || 8000,
});

// Create microservice
const app = new MicroMQ({
    name: 'ethMonitor',
    rabbit: {
        url: process.env.RABBIT_URL || 'amqp://guest:guest@localhost:5672',
    },
});

// Connect to Mongo DB
mongoClient.connect(function (err, client) {
    if (err) {
        console.log(err);
    } else {
        console.log("Connected successfully to Mongo server");
        mongoCloDb = client.db(dbName);
        mongoBlocksTable = mongoCloDb.collection('blocks');
        mongoTxsTable = mongoCloDb.collection('txs');
        cleanCached(true);
        setTimeout(onCleanTimer, 1000 * 60);
    }
});

// Timer for cleaning cache
function onCleanTimer() {
    setTimeout(onCleanTimer, 1000 * 60); // one minute timer
    cleanCached();
}

// Clean old ( > 1 hour ) cache records
async function cleanCached(fullClean = false) {
    let fltr;

    if (fullClean) {
        fltr = { $exists: true };
    } else {
        let dt = new Date();
        dt.setTime(dt.getTime() - oneHourMs);
        fltr = { $lte: dt };
    }

    try {
        await mongoBlocksTable.deleteMany({'cached' : fltr });
        await mongoTxsTable.deleteMany({'cached' : fltr });
    } catch (e) {
        console.log(e);
    }
}

// Receive new block from Node (by event)
function newEthBlock(error, blockHeader) {
    if (!error) {
       web3.eth.getBlock(blockHeader.number, true)
           .then(txBlockObj => {
               if (txBlockObj) {
                   storeNewBlock(blockHeader, txBlockObj);
                   checkSubscribers(txBlockObj.transactions);
               }
           })
           .catch(e => {
               console.log('Get block error: ', e);
           });
    }
}

// Cache blocks to DB
// New blocks - keep 100 latest
// Cached flag - for old blocks, queued by user request - they are stored for 1 hour
async function storeNewBlock(blockHeader, txBlockObj, cached = false) {
    if (cached) {
        const dt = new Date();

        blockHeader.cached = dt;  // field for checking how old is record

        const txS = txBlockObj.transactions;
        for (let i = 0; i < txS.length; i++) {
            txS[i].cached = dt;
        }
    }

    try {
        await mongoBlocksTable.insertOne(blockHeader);

        if (txBlockObj.transactions) {
            await mongoTxsTable.insertMany(txBlockObj.transactions);
        }

        if (!cached) {
            removeOldBlocks(blockHeader.number);
        }
    } catch (e) {
        console.log(e);
    }
}

// Cache txs, queued by user request - they are stored for 1 hour
async function storeNewTx(txObj) {
    txObj.cached = new Date();

    try {
        await mongoTxsTable.insertOne(txObj);
    } catch (e) {
        console.log(e);
    }
}

// Keep only 100 latest blocks - checked by number, no real counter
async function removeOldBlocks(blockNumber) {
    const oldest = blockNumber - keepBlocks;

    try {
        await mongoBlocksTable.deleteMany({'number' : {$lte: oldest}, 'cached' : { $exists: false } });
        await mongoTxsTable.deleteMany({'blockNumber' : {$lte: oldest}, 'cached' : { $exists: false } });
    } catch (e) {
        console.log(e);
    }
}

// Query block from blockchain, if it's not cached
async function getEthBlock(blockNumber) {
    const block = await web3.eth.getBlock(blockNumber, true);

    if (block) {
        let blockHeader = { ... block };
        delete blockHeader.transactions;
        storeNewBlock(blockHeader, block, true);
    }

    return block;
}

// Query Tx from blockchain, if it's not cached
async function getEthTx(txHash) {
    const txObj = await web3.eth.getTransaction(txHash);

    if (txObj) {
        storeNewTx(txObj);
    }

    return txObj;
}

// Process REST query - find block by ID
async function getBlockById(req, res) {
    const { id } = req.params;
    console.log('getting block: ', id);

    const nId =  Number(id);
    if (isNaN(nId)) {
        res.statusCode = 400;
        res.end('Invalid ID');
        return;
    }

    let block;
    try {
        block = await mongoBlocksTable.findOne({'number' : nId});

        if (block) {
            block.transactions = await mongoTxsTable.find({'blockNumber' : nId}).toArray();
        } else {
            console.log('Query block from Node: ', id);
            block = await getEthBlock(nId);
        }

        if (!block) {
            res.statusCode = 404;
            res.end('Block not found');
            return;
        }
    } catch (e) {
        console.log(e);
        res.statusCode = 400;
        res.end('error getting Block');
        return;
    }

    res.json([
        block
    ]);
}

// Process REST query - find TX by hash
async function getTxById(req, res) {
    const { id } = req.params;
    console.log('getting transaction: ', id);

    let txObj;
    try {
        txObj = await mongoTxsTable.findOne({'hash' : id});

        if (!txObj) {
            console.log('Query tx from Node: ', id);
            txObj = await getEthTx(id);
        }

        if (!txObj) {
            res.statusCode = 404;
            res.end('Tx not found');
            return;
        }
    } catch (e) {
        console.log(e);
        res.statusCode = 400;
        res.end('error getting Tx');
        return;
    }

    res.json([
        txObj
    ]);
}

// Register address for monitoring new transactions
function addAddressMonitor(address, client) {
    if (clients.has(address)) {
        const subscribers = clients.get(address);

        if (!subscribers.includes(client)) {
            console.log('Adding address monitoring: ', address);
            subscribers.push(client);
        }
    } else {
        const subscribers = [];

        subscribers.push(client);
        clients.set(address, subscribers);
    }
}

// UnRegister address monitoring
function removeAddressMonitor(address, client) {
    if (clients.has(address)) {
        const subscribers = clients.get(address);

        console.log('Stop address monitoring: ', address);

        subscribers.splice (subscribers.indexOf(client), 1);
    }
}

// Check transactions in new block - for WS subscriptions
function checkSubscribers(transactions) {
    transactions.forEach((tx) => {
        notifyAddress(tx.from, tx);
        notifyAddress(tx.to, tx);
    });
}

// Check one address for subscriptions
function notifyAddress(address, tx) {
    if (clients.has(address)) {
        const subscribers = clients.get(address);

        subscribers.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(tx));
            } else {
                console.log('ws client closed');
                subscribers.splice (subscribers.indexOf(client), 1);
            }
        });
    }
}

// Register REST endpoints
app.get('/block/:id', getBlockById);
app.get('/transaction/:id', getTxById);

// Process WebSocket messages
ws.on('connection', (connection) => {
    connection.on('message', (message) => {
        console.log('ws message: ', message);
        try {
            const {event, data} = JSON.parse(message);

            const address = data;

            switch (event) {
                case 'subscribe': {
                    addAddressMonitor(address, connection);
                    connection.send(`subscribed: ${address}`);
                    break;
                }
                case 'unsubscribe': {
                    removeAddressMonitor(address, connection);
                    connection.send(`unsubscribed: ${address}`);
                    break;
                }
            }

        } catch(e) {
            console.log(e);
        }
    });
});

ws.on('close', () => {
    console.log('closing ws');
});

app.start();


// Close connections before shutdown
const startGracefulShutdown = () => {
    console.log('Starting shutdown ...');

    ws.clients.forEach(function each(ws) {
        ws.close();
    });

    subscription.unsubscribe(function(error, success){
        if(success) {
            console.log('Successfully unsubscribed!');
            process.exit(0);
        } else {
            console.log(error);
            process.exit(1);
        }
    });
}

process.on('SIGTERM', startGracefulShutdown);
process.on('SIGINT', startGracefulShutdown);
