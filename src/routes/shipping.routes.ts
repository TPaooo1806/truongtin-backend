import { Router } from 'express';
import { calculateShippingFee } from '../controllers/shipping.controller';

const router = Router();

// POST /api/shipping/calculate
router.post('/calculate', calculateShippingFee);

export default router;
