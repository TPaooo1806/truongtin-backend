import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import multer from 'multer';
import dotenv from 'dotenv';

dotenv.config();

// 1. Khai báo xác thực với Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// 2. Cấu hình kho lưu trữ
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'truongtin_images', // Tên thư mục nó sẽ tự tạo trên Cloudinary
    allowedFormats: ['jpg', 'png', 'jpeg', 'webp'], // Chỉ cho phép up ảnh
  } as any,
});

// 3. Khởi tạo Middleware Multer
export const upload = multer({ storage: storage });
