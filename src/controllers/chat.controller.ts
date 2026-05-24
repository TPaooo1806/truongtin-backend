import { Request, Response } from 'express';
import { GoogleGenerativeAI, FunctionDeclaration, SchemaType, Tool } from '@google/generative-ai';
import catalogCacheService from '../services/catalogCache.service';

const SYSTEM_INSTRUCTION = `Bạn là "Trợ lý báo giá", nhân viên tư vấn ảo của cửa hàng điện nước "Trường Tín".
Nhiệm vụ của bạn là tư vấn, báo giá sản phẩm và chốt đơn cho khách hàng một cách thân thiện, ngắn gọn và chuyên nghiệp.

QUY TẮC BẮT BUỘC (CRITICAL RULES):
1. KHÔNG BAO GIỜ bịa đặt hoặc tự đoán giá sản phẩm. Bạn BẮT BUỘC phải dùng công cụ \`search_product\` để kiểm tra thông tin thực tế trước khi báo giá.
2. Nếu không tìm thấy sản phẩm qua công cụ, hãy nói: "Dạ hiện tại trên hệ thống em chưa tìm thấy mã này. Anh/chị có thể nhắn qua Zalo (0909515205) để nhân viên kiểm tra trực tiếp nhé."
3. Báo giá luôn kèm theo đơn vị tính (VD: 95.000đ/Cái). Nếu số lượng tồn kho thấp (<5), hãy báo khách đặt nhanh kẻo hết.
4. LUÔN LUÔN kết thúc cuộc tư vấn bằng cách mời khách hàng click vào nút "Zalo" hoặc "Gọi Hotline" để chốt đơn sỉ/lẻ nhanh nhất.
5. Câu trả lời phải ngắn gọn (dưới 50 từ), dùng tiếng Việt tự nhiên, xưng hô "Em" và "Anh/Chị". Tránh dài dòng văn tự.`;

// Định nghĩa tool search_product cho Gemini
const searchProductDeclaration: FunctionDeclaration = {
  name: "search_product",
  description: "Tìm kiếm sản phẩm trong kho của cửa hàng Trường Tín để lấy thông tin về giá bán và tồn kho hiện tại.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      query: {
        type: SchemaType.STRING,
        description: "Tên sản phẩm hoặc từ khóa cần tìm kiếm (VD: bóng đèn, ống nước, kềm)",
      },
    },
    required: ["query"],
  },
};

const tools: Tool[] = [
  {
    functionDeclarations: [searchProductDeclaration],
  },
];

export const chatWithAI = async (req: Request, res: Response) => {
  try {
    const { message, history } = req.body;
    
    if (!message) {
      return res.status(400).json({ success: false, message: "Tin nhắn không được để trống" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ success: false, message: "Chưa cấu hình GEMINI_API_KEY" });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: SYSTEM_INSTRUCTION,
      tools: tools
    });

    // Chuyển đổi history từ format frontend sang format của Gemini
    let formattedHistory = (history || []).map((msg: any) => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

    // Sửa lỗi Gemini: message đầu tiên trong history BẮT BUỘC phải là 'user'
    if (formattedHistory.length > 0 && formattedHistory[0].role === 'model') {
      formattedHistory.shift();
    }

    const chat = model.startChat({
      history: formattedHistory,
    });

    // Gửi tin nhắn đầu tiên
    let result = await chat.sendMessage(message);
    let call = result.response.functionCalls()?.[0];

    // Nếu Gemini quyết định gọi hàm search_product
    if (call && call.name === "search_product") {
      const args = call.args as any;
      const query = args.query;
      
      console.log(`[Chatbot] AI đang tìm kiếm từ khóa: "${query}"`);
      
      // Tìm kiếm trong RAM Cache
      const searchResults = catalogCacheService.searchProducts(query);
      
      // Format kết quả trả về cho AI
      let apiResponse: any;
      if (searchResults.length > 0) {
        apiResponse = {
          success: true,
          products: searchResults.map(p => ({
            name: p.name,
            price: p.minPrice === p.maxPrice ? p.minPrice : `${p.minPrice} - ${p.maxPrice}`,
            stock: p.stock,
            unit: p.unit
          }))
        };
      } else {
        apiResponse = { success: false, message: "Không tìm thấy sản phẩm nào phù hợp." };
      }

      // Trả kết quả function call lại cho Gemini để nó gen ra câu trả lời cuối cùng
      result = await chat.sendMessage([{
        functionResponse: {
          name: "search_product",
          response: apiResponse
        }
      }]);
    }

    // Lấy câu trả lời text cuối cùng
    const textResponse = result.response.text();
    
    return res.json({ success: true, reply: textResponse });

  } catch (error) {
    console.error("[Chatbot Error]:", error);
    return res.status(500).json({ success: false, message: "Lỗi kết nối với Trợ lý AI" });
  }
};
