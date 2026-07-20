// functions/api/invite/packages.js — GET /api/invite/packages
import { json } from '../../_utils.js';
import { CASH_PACKAGES, SPIRIT_STONE_PACKAGES } from '../../_xp.js';

export async function onRequest(context) {
  const { request } = context;

  if (request.method === 'GET') {
    return json({
      ok: true,
      cash_packages: CASH_PACKAGES,
      spirit_packages: SPIRIT_STONE_PACKAGES,
    });
  }

  return json({ error: 'Method not allowed' }, 405);
}
