const Gateway = require('micromq/gateway');

const gateway = new Gateway({
    microservices: ['ethMonitor'],
    rabbit: {
        url: process.env.RABBIT_URL || 'amqp://guest:guest@localhost:5672',
    },
});

gateway.get('/block/:id', (req, res) => res.delegate('ethMonitor'));

gateway.get('/transaction/:id', (req, res) => res.delegate('ethMonitor'));

gateway.listen(process.env.PORT || 9000);
