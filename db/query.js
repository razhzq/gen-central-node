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

        if (!meter_identifier || !iot_pubkey) {
            throw new Error('meter_identifier and iot_pubkey are required');
        }
        const resolvedAssetType = asset_type || 'MONITORING_ONLY';

        // If site_id provided, validate it exists
        if (site_id) {
            const siteRes = await query(
                'SELECT id FROM sites WHERE id = $1',
                [site_id]
            );
            if (siteRes.rowCount === 0) {
                throw new Error('Site does not exist');
            }
        }

        const existing = await query(
            'SELECT id FROM meters WHERE meter_identifier = $1',
            [meter_identifier]
        );

        if (existing.rowCount > 0) {
            // Re-registration: update iot_pubkey, firmware, installed_at; do not overwrite site_id (admin links in UI)
            await query(
                `UPDATE meters SET iot_pubkey = $1, firmware_version = $2, active = true, installed_at = now()
                 WHERE meter_identifier = $3`,
                [iot_pubkey, firmware_version || null, meter_identifier]
            );
            return existing.rows[0].id;
        }

        const id = meter_id || require('crypto').randomUUID();
        await query(
            `INSERT INTO meters (
                id,
                site_id,
                meter_identifier,
                iot_pubkey,
                asset_type,
                firmware_version,
                active,
                installed_at
            ) VALUES ($1, $2, $3, $4, $5, $6, true, now())`,
            [
                id,
                site_id || null,
                meter_identifier,
                iot_pubkey,
                resolvedAssetType,
                firmware_version || null
            ]
        );

        return id;
    } catch (err) {
        console.log('error registering meter: ', err);
        throw err;
    }
};