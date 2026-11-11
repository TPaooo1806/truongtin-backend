/**
 * HỆ THỐNG AUTOMATION KIỂM DUYỆT TỪ NGỮ BÌNH LUẬN (CONTENT MODERATION)
 * Tự động phát hiện các từ cấm, thô tục, chửi thề, lăng mạ hoặc lừa đảo/spam.
 */

export const BANNED_WORDS = [
  // 1. Chửi thề, thô tục, lăng mạ
  'đm', 'dmm', 'đmm', 'đkm', 'dkm', 'vcl', 'vcll', 'địt', 'dit', 'đụ', 'đụ má', 'đụ mẹ', 
  'du me', 'du ma', 'lồn', 'lon', 'cặc', 'cac', 'buồi', 'buoi', 'đéo', 'deo', 'chó đẻ', 
  'óc chó', 'mẹ mày', 'bố mày', 'thằng chó', 'mất dạy', 'khốn nạn', 'súc sinh', 'chết tiệt', 
  'đồ ngu', 'óc lợn', 'con mẹ', 'thằng ml', 'đĩ', 'con đĩ', 'bọn chó', 'lũ chó', 'chó má',
  'mẹ kiếp', 'bà mẹ', 'má nó', 'đụ cụ', 'thằng ranh', 'con điếm', 'đĩ mẹ',

  // 2. Vu khống, lừa đảo, ngôn từ tiêu cực cực đoan
  'lừa đảo', 'lua dao', 'scam', 'scammer', 'bịp bợm', 'treo đầu dê bán thịt chó', 
  'hàng đểu', 'gian thương', 'ăn cướp', 'an cuop', 'đa cấp', 'đồ rác rưởi',

  // 3. Spam link, cờ bạc, tín dụng đen
  'tài xỉu', 'tai xiu', 'ku bet', 'kubet', 'thabet', 'cờ bạc', 'đánh bạc', 
  'tín dụng đen', 'vay tiền', 'cho vay nặng lãi', 'link bio'
];

/**
 * Kiểm tra nội dung bình luận có chứa từ cấm không.
 */
export function checkProfanity(text: string): { isProfane: boolean; matchedWords: string[] } {
  if (!text || typeof text !== 'string') {
    return { isProfane: false, matchedWords: [] };
  }

  // Chuẩn hóa văn bản: Chuyển chữ thường
  const lower = text.toLowerCase();
  
  // Xóa các ký tự xen kẽ nhằm lách luật (ví dụ: đ.m, đ-m, đ_m, c.ặ.c, l.ồ.n)
  const deLeeted = lower.replace(/[\.\-_\*@#\$\%]/g, '');

  const matched = new Set<string>();

  for (const word of BANNED_WORDS) {
    // Tìm kiếm trong văn bản gốc hoặc văn bản đã khử ký tự xen kẽ
    const regex = new RegExp(`(^|\\s|[.,!?;])${word.replace(/\s+/g, '\\s+')}($|\\s|[.,!?;])`, 'i');
    if (regex.test(lower) || regex.test(deLeeted) || lower.includes(` ${word} `) || lower.startsWith(`${word} `) || lower.endsWith(` ${word}`)) {
      matched.add(word);
    }
  }

  return {
    isProfane: matched.size > 0,
    matchedWords: Array.from(matched)
  };
}

