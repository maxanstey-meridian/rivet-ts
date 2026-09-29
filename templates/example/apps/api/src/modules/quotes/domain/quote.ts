export type Quote = {
  id: string;
  text: string;
  author: string;
  addedAt: string;
};

export const quoteTextsMatch = (left: string, right: string): boolean =>
  left.trim().toLowerCase() === right.trim().toLowerCase();
