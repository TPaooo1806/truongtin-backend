import { Request, Response } from 'express';
import prisma from '../config/prisma'; // Đảm bảo đường dẫn này đúng với file prisma của bạn

// Tự định nghĩa lại Request của Express để chứa thông tin user từ Token (Không dùng any)
interface AuthRequest extends Request {
  user?: {
    id: number;
    [key: string]: unknown;
  };
}

// ============================================================================
// 1. API GET: LẤY DANH SÁCH BÌNH LUẬN (Ai cũng xem được)
// ============================================================================
export const getProductReviews = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const reviews = await prisma.review.findMany({
      where: { productId: Number(id) },
      include: {
        user: { select: { name: true } } // Chỉ lấy tên để an toàn bảo mật
      },
      orderBy: { createdAt: 'desc' } // Mới nhất lên đầu
    });

    res.status(200).json({ success: true, data: reviews });
  } catch (error) {
    console.error("Lỗi lấy danh sách đánh giá:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

// ============================================================================
// 2. API POST: GỬI BÌNH LUẬN MỚI (Bắt buộc phải có Token)
// ============================================================================
export const createReview = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { productId, rating, comment } = req.body;
    
    // 1. IN RA ĐỂ KIỂM TRA XEM TRONG TOKEN CỦA BẠN CHỨA CÁI GÌ
    console.log("Dữ liệu User giải mã từ Token:", req.user);

    // 2. Lấy ID người dùng (Hỗ trợ cả 2 trường hợp bạn đặt tên lúc Login là id hay userId)
    const userId = req.user?.id || (req.user as any)?.userId; 

    // Nếu vẫn không có ID, báo lỗi rõ ràng để dễ fix
    if (!userId) {
       res.status(401).json({ success: false, message: "Token hợp lệ nhưng không tìm thấy ID người dùng!" });
       return;
    }

    if (!productId || !rating) {
      res.status(400).json({ success: false, message: "Thiếu thông tin đánh giá" });
      return;
    }

    // Lưu vào Database
    const newReview = await prisma.review.create({
      data: {
        rating: Number(rating),
        comment: comment || "",
        userId: Number(userId),
        productId: Number(productId)
      },
      include: {
        user: { select: { name: true } }
      }
    });

    res.status(201).json({ success: true, data: newReview });
  } catch (error) {
    console.error("Lỗi gửi đánh giá:", error);
    res.status(500).json({ success: false, message: "Lỗi server khi gửi đánh giá" });
  }
};