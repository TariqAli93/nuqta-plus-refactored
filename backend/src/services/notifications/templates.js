/**
 * Notification template registry.
 *
 * Each template declares:
 *   - body:     default text with `{{variable}}` placeholders.
 *   - variables: variables the body refers to (used for validation).
 *   - required:  subset of `variables` that must be provided (rest are optional;
 *                missing optional variables render as empty strings).
 *
 * Operators can override the body via NotificationSettings.templates without
 * changing the variable list — render() will still validate that every
 * required variable is supplied.
 */

import { ValidationError } from '../../utils/errors.js';

export const TEMPLATE_KEYS = Object.freeze({
  OVERDUE_INSTALLMENT_REMINDER: 'overdue_installment_reminder',
  PAYMENT_CONFIRMATION: 'payment_confirmation',
  CUSTOM_CUSTOMER_MESSAGE: 'custom_customer_message',
  BULK_CUSTOMER_MESSAGE: 'bulk_customer_message',
});

export const DEFAULT_TEMPLATES = Object.freeze({
  [TEMPLATE_KEYS.OVERDUE_INSTALLMENT_REMINDER]: {
    body:
      'عزيزي {{customerName}}، نذكركم بأن قسط رقم {{installmentNumber}} ' +
      'بقيمة {{amount}} كان مستحقاً بتاريخ {{dueDate}}. ' +
      'الرجاء التواصل معنا لتسديد المبلغ. — {{businessName}}',
    variables: [
      'customerName',
      'customerPhone',
      'amount',
      'dueDate',
      'invoiceNumber',
      'installmentNumber',
      'businessName',
    ],
    required: ['customerName', 'amount', 'dueDate', 'installmentNumber'],
  },
  [TEMPLATE_KEYS.PAYMENT_CONFIRMATION]: {
    body:
      'عزيزي {{customerName}}، تم استلام دفعتكم بقيمة {{paidAmount}} ' +
      'لفاتورة رقم {{invoiceNumber}}. المتبقي: {{remainingAmount}}. ' +
      'شكراً لتعاملكم — {{businessName}}',
    variables: [
      'customerName',
      'customerPhone',
      'paidAmount',
      'remainingAmount',
      'invoiceNumber',
      'businessName',
    ],
    required: ['customerName', 'paidAmount'],
  },
  [TEMPLATE_KEYS.CUSTOM_CUSTOMER_MESSAGE]: {
    body: '{{messageBody}}',
    variables: ['customerName', 'customerPhone', 'messageBody', 'businessName'],
    required: ['messageBody'],
  },
  [TEMPLATE_KEYS.BULK_CUSTOMER_MESSAGE]: {
    body: '{{messageBody}}',
    variables: ['customerName', 'customerPhone', 'messageBody', 'businessName'],
    required: ['messageBody'],
  },
});

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function isValidTemplateKey(key) {
  return Object.values(TEMPLATE_KEYS).includes(key);
}

/**
 * Resolve a template definition, applying any operator-defined body override.
 * Throws ValidationError when the template key is unknown.
 */
export function resolveTemplate(templateKey, overrides = null) {
  if (!isValidTemplateKey(templateKey)) {
    throw new ValidationError(`Unknown notification template: ${templateKey}`);
  }
  const base = DEFAULT_TEMPLATES[templateKey];
  const override =
    overrides && typeof overrides === 'object' && typeof overrides[templateKey]?.body === 'string'
      ? overrides[templateKey].body
      : null;
  return {
    key: templateKey,
    body: override || base.body,
    variables: base.variables,
    required: base.required,
  };
}

/**
 * Validate that a payload supplies every required variable for the template.
 * Returns the sanitized variables map (extra keys are dropped).
 */
export function validatePayload(templateKey, payload, overrides = null) {
  const tpl = resolveTemplate(templateKey, overrides);
  const data = payload && typeof payload === 'object' ? payload : {};
  const missing = tpl.required.filter(
    (v) => data[v] === undefined || data[v] === null || data[v] === ''
  );
  if (missing.length > 0) {
    throw new ValidationError(
      `Missing required template variables for "${templateKey}": ${missing.join(', ')}`
    );
  }
  const safe = {};
  for (const v of tpl.variables) {
    if (data[v] !== undefined && data[v] !== null) safe[v] = String(data[v]);
  }
  return safe;
}

/**
 * Render the template body with the given variables. Unknown placeholders are
 * left untouched; missing optional variables are replaced with an empty string.
 */
export function render(templateKey, payload, overrides = null) {
  const tpl = resolveTemplate(templateKey, overrides);
  const safe = validatePayload(templateKey, payload, overrides);
  return tpl.body.replace(VARIABLE_PATTERN, (_, name) => {
    if (Object.prototype.hasOwnProperty.call(safe, name)) return safe[name];
    return '';
  });
}

/**
 * Public list of templates — useful for the Settings UI to show editable
 * defaults and known variable lists.
 */
export function listTemplates(overrides = null) {
  return Object.values(TEMPLATE_KEYS).map((key) => resolveTemplate(key, overrides));
}
