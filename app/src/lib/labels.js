export const KIND_LABEL = { bank: '銀行', cash: '現金', emoney: '電子マネー', credit: 'クレジットカード' };
export const KIND_OPTIONS = Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }));
export const TYPE_LABEL = { income: '入金', expense: '出金', transfer: '振替' };
