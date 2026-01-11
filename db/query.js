const { query } = require(".")




module.exports.registerMeter = async (data) => {
    try {
        const {
            site_id,
            meter_id,
            meter_identifier,
            iot_pubkey,
            asset_type,
            firmware_version
        } = data;

        const siteRes = await query(
            'SELECT id FROM sites WHERE id = $1',
            [site_id]
        );
        if (siteRes.rowCount === 0) {
            throw new Error('Site does not exist');
        }

        await query(
        `
         INSERT INTO meters (
            id,
            site_id,
            meter_identifier,
            iot_pubkey,
            asset_type,
            firmware_version,
            active,
            installed_at
        ) VALUES (
            $1,$2,$3,$4,$5,$6,true,now()
        )
        `,
        [
            meter_id,
            site_id,
            meter_identifier,
            iot_pubkey,
            asset_type,
            firmware_version || null
        ]
        );

        return meter_id;
    } catch (err) {
        console.log('error registering meter: ', err)
        throw err
    }
}