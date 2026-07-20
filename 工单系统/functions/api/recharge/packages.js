// functions/api/recharge/packages.js — GET /api/recharge/packages
import { json } from '../../_utils.js';
import { CASH_PACKAGES, SPIRIT_STONE_PACKAGES, BASE_RECHARGE } from '../../_xp.js';

export async function onRequest(context) {
  const { request } = context;
  if (request.method === 'GET') {
    return json({
      ok: true,
      cash_packages: CASH_PACKAGES,
      spirit_packages: SPIRIT_STONE_PACKAGES,
      base_recharge: BASE_RECHARGE,
    });
  }
  return json({ error: 'Method not allowed' }, 405);
}
