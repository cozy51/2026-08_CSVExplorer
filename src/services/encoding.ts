export interface DecodedCsv {
  text: string;
  encoding: 'UTF-8' | 'Shift_JIS';
}

function decodingPenalty(text: string): number {
  const replacements = (text.match(/\uFFFD/g) ?? []).length;
  // Typical UTF-8-as-Shift_JIS / Shift_JIS-as-UTF-8 artifacts.
  const suspicious = (text.match(/[�]|(?:縺|繧|譁|蜿|莨|陦|逕|髫|鬆)/g) ?? []).length;
  const controls = [...text].filter((character) => {
    const code = character.charCodeAt(0);
    return code < 32 && !['\n', '\r', '\t'].includes(character);
  }).length;
  return replacements * 20 + suspicious * 4 + controls * 10;
}

export function decodeCsvBuffer(buffer: ArrayBuffer): DecodedCsv {
  const bytes = new Uint8Array(buffer);
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  let shiftJis: string;

  try {
    shiftJis = new TextDecoder('shift_jis').decode(bytes);
  } catch {
    // All target evergreen browsers support Shift_JIS. Keep UTF-8 usable on
    // uncommon runtimes whose ICU data does not include the decoder.
    return { text: utf8.replace(/^\uFEFF/, ''), encoding: 'UTF-8' };
  }

  const useShiftJis = decodingPenalty(shiftJis) < decodingPenalty(utf8);
  return useShiftJis
    ? { text: shiftJis.replace(/^\uFEFF/, ''), encoding: 'Shift_JIS' }
    : { text: utf8.replace(/^\uFEFF/, ''), encoding: 'UTF-8' };
}

export const encodingInternals = { decodingPenalty };
