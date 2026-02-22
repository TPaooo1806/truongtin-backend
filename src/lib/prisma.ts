import { PrismaClient } from "@prisma/client";

// Khởi tạo một instance duy nhất và dùng chung cho toàn bộ server
const prisma = new PrismaClient();

export default prisma;