import { parseMoney } from './number.js';

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function getCellValue(headers, rows, cellRef) {
  const match = /^([A-Z]+)(\d+)$/i.exec(String(cellRef || '').trim());
  if (!match) {
    return '';
  }

  const [, letters, rowDigits] = match;
  const rowNumber = Number.parseInt(rowDigits, 10);
  const columnIndex =
    letters
      .toUpperCase()
      .split('')
      .reduce((acc, char) => acc * 26 + (char.charCodeAt(0) - 64), 0) - 1;

  if (rowNumber === 1) {
    return headers[columnIndex] || '';
  }

  return rows[rowNumber - 2]?.[columnIndex] || '';
}

export function findComponentValue(headers, rows, component, config = {}) {
  if (component.cellRef) {
    const rawCellValue = getCellValue(headers, rows, component.cellRef);
    return {
      found: String(rawCellValue || '').trim() !== '',
      value: parseMoney(rawCellValue),
    };
  }

  const labelColumnIndex = Number.isInteger(component.labelColumnIndex)
    ? component.labelColumnIndex
    : Number.isInteger(config.labelColumnIndex)
      ? config.labelColumnIndex
      : 0;
  const valueColumnIndex = Number.isInteger(component.valueColumnIndex)
    ? component.valueColumnIndex
    : Number.isInteger(config.valueColumnIndex)
      ? config.valueColumnIndex
      : 1;
  const target = normalizeText(component.labelMatch);

  const matchedRow = rows.find((row) => {
    const label = normalizeText(row[labelColumnIndex]);
    if (!label || !target) {
      return false;
    }

    if (component.matchMode === 'exact') {
      return label === target;
    }

    return label.includes(target);
  });

  if (!matchedRow) {
    return { found: false, value: 0 };
  }

  return {
    found: true,
    value: parseMoney(matchedRow[valueColumnIndex]),
  };
}
