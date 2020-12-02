const WebSocket = require('ws');

const client = new WebSocket('ws://localhost:8000');

client.on('message', msg => {
    console.log(msg)
});

// await new Promise(resolve => client.once('open', resolve));

client.on('open', () => {
    client.send(JSON.stringify({event: 'subscribe', data: '0xfd18F875B8f'}));
    client.send(JSON.stringify({event: 'unsubscribe', data: '0xfd18F875B8f'}));
    client.send(JSON.stringify({event: 'subscribe', data: '0xa21caEbD27a296678176aC886735bfd18F875B8f'}));
});

client.on('close', () => {
   console.log('connection closed');
});


