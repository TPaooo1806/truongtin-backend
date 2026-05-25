import { Router, Request, Response } from 'express';
import cloudinary, { upload } from '../lib/cloudinary';
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

// Endpoint: GET /api/upload/signature
// Dùng cho việc Client-side Upload hàng loạt
router.get('/signature', verifyToken, isAdmin, (req: Request, res: Response): void => {
  try {
    const timestamp = Math.round((new Date()).getTime() / 1000);
    const folder = 'truongtin_images';
    
    const signature = cloudinary.utils.api_sign_request({
      timestamp,
      folder
    }, process.env.CLOUDINARY_API_SECRET!);
    
    res.status(200).json({
      success: true,
      data: {
        timestamp,
        signature,
        cloudName: process.env.CLOUDINARY_CLOUD_NAME,
        apiKey: process.env.CLOUDINARY_API_KEY,
        folder
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Lỗi tạo signature." });
  }
});

export default router;
