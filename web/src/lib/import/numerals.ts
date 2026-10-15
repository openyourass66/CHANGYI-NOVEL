/** 中文数字 ↔ 阿拉伯数字。用于章节序号归一：中文数字（第一章）与阿拉伯数字（第1章）混用时统一排序。 */

const DIGITS: Record<string, number> = {
  零: 0,
  "〇": 0,
  一: 1,
  壹: 1,
  二: 2,
  两: 2,
  贰: 2,
  三: 3,
  叁: 3,
  四: 4,
  肆: 4,
  五: 5,
  伍: 5,
  六: 6,
  陆: 6,
  七: 7,
  柒: 7,
  八: 8,
  捌: 8,
  九: 9,
  玖: 9,
};

const SMALL_UNITS: Record<string, number> = {
  十: 10,
  拾: 10,
  百: 100,
  佰: 100,
  千: 1000,
  仟: 1000,
};

/** 允许出现的数字字符（中文 + 阿拉伯）。 */
export const NUMBER_CHARS = "0-9０-９" + Object.keys(DIGITS).join("") + Object.keys(SMALL_UNITS).join("") + "万萬亿億廿卅";

const FULLWIDTH_OFFSET = 0xff10 - 0x30;

function normalizeDigits(s: string): string {
  return s.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - FULLWIDTH_OFFSET),
  );
}

/**
 * 解析中文或阿拉伯数字。
 * 支持：12 / 十二 / 一百零三 / 三千 / 两万 / 廿 / 卅 等。
 * 无法解析时返回 null。
 */
export function parseNumber(raw: string): number | null {
  const s = normalizeDigits(raw.trim());
  if (!s) return null;

  if (/^[0-9]+$/.test(s)) return Number.parseInt(s, 10);

  // 廿 / 卅 特例
  if (s === "廿") return 20;
  if (s === "卅") return 30;

  let total = 0;
  let section = 0;
  let number = 0;
  let seen = false;

  for (const ch of s) {
    if (ch in DIGITS) {
      number = DIGITS[ch];
      seen = true;
    } else if (ch in SMALL_UNITS) {
      const unit = SMALL_UNITS[ch];
      if (!seen && unit === 10) number = 1; // 「十二」→ 12
      section += (number || 1) * unit;
      number = 0;
      seen = true;
    } else if (ch === "万" || ch === "萬") {
      total += (section + number) * 10000;
      section = 0;
      number = 0;
      seen = true;
    } else if (ch === "亿" || ch === "億") {
      total = (total + section + number) * 100000000;
      section = 0;
      number = 0;
      seen = true;
    } else if (ch === "廿") {
      section += 20;
      seen = true;
    } else if (ch === "卅") {
      section += 30;
      seen = true;
    } else {
      return null;
    }
  }

  if (!seen) return null;
  return total + section + number;
}
