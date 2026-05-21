import { Router, Request, Response } from 'express';
import { upload } from '../lib/cloudinary';
import { verifyToken, isAdmin } from '../middlewares/auth.middleware';

const router = Router();

// Endpoint: POST /api/upload
// Chỉ Admin đã đăng nhập mới được upload ảnh lên Cloudinary
router.post('/', verifyToken, isAdmin, upload.single('image'), (req: Request, res: Response): void => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: "Không tìm thấy file!" });
      return;
    }
    // Thành công! Cloudinary trả về link URL của ảnh
    res.status(200).json({ 
      success: true, 
      imageUrl: req.file.path // 💡 ĐÂY LÀ CÁI LINK BẠN CẦN LƯU VÀO DATABASE
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Lỗi upload ảnh." });
  }
});

export default router;
