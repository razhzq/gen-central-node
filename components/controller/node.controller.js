const { registerMeter } = require("../../db/query");

module.exports.registerNodeCtrl = async (req, res) => {
    try {
        console.log('req.body: ', req.body);
        const result = await registerMeter(req.body);
        res.status(201).json({
            meter_id: result.meter_id,
            gcp_key_id: result.gcp_key_id,
            key_status: result.key_status,
            status: 'REGISTERED'
        });
    } catch (err) {
        res.status(500).json({
            status: 500,
            message: 'Error registering meter node'
        })
    }
}