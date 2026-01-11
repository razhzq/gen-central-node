const { registerMeter } = require("../../db/query");

module.exports.registerNodeCtrl = async (req, res) => {
    try {
        console.log('req.body: ', req.body);
         const meterId = await registerMeter(req.body);
         res.status(201).json({ meter_id: meterId, status: 'REGISTERED' });
    } catch (err) {
        res.status(500).json({
            status: 500,
            message: 'Error registering meter node'
        })
    }
}