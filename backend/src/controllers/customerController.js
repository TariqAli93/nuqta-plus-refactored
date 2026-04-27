import { CustomerService } from '../services/customerService.js';
import { customerSchema } from '../utils/validation.js';
import {
  getCustomerCreditSnapshot,
  calculateAndPersistCreditScore,
  getRiskLevel,
  assessAndLogCreditRisk,
} from '../services/creditScoringService.js';
import {
  getScoringMode,
  getModelVersion,
  isCreditScoreModelAvailable,
} from '../services/onnxCreditScoringService.js';

const customerService = new CustomerService();

export class CustomerController {
  async create(request, reply) {
    const validatedData = customerSchema.parse(request.body);
    const customer = await customerService.create(validatedData, request.user.id);
    return reply.code(201).send({
      success: true,
      data: customer,
      message: 'Customer created successfully',
    });
  }

  async getAll(request, reply) {
    const result = await customerService.getAll(request.query);
    return reply.send({
      success: true,
      data: result.data,
      meta: result.meta,
    });
  }

  async getById(request, reply) {
    const customer = await customerService.getById(request.params.id);
    return reply.send({
      success: true,
      data: customer,
    });
  }

  async update(request, reply) {
    const validatedData = customerSchema.partial().parse(request.body);
    const customer = await customerService.update(request.params.id, validatedData);
    return reply.send({
      success: true,
      data: customer,
      message: 'Customer updated successfully',
    });
  }

  async delete(request, reply) {
    const result = await customerService.delete(request.params.id);
    return reply.send({
      success: true,
      message: result.message,
    });
  }

  /**
   * Read the cached credit score + recommended limit for a customer.
   * Served from customers row — no recalculation, POS-safe.
   */
  async getCreditSnapshot(request, reply) {
    const snapshot = await getCustomerCreditSnapshot(Number(request.params.id));
    return reply.send({ success: true, data: snapshot });
  }

  /**
   * Force an on-demand recalculation for a single customer. Admin/manager only.
   * The nightly job still refreshes everyone else.
   */
  async recalculateCreditScore(request, reply) {
    const result = await calculateAndPersistCreditScore(Number(request.params.id));
    return reply.send({
      success: true,
      data: {
        ...result,
        riskLevel: getRiskLevel(result.score),
        scoring_mode: getScoringMode(),
        model_version: result.modelVersion ?? getModelVersion(),
        model_loaded: isCreditScoreModelAvailable(),
      },
    });
  }

  /**
   * Hybrid risk assessment for a single customer. Returns the structured
   * explanation (probability + level + reasons + features) and persists the
   * call into credit_scores for monitoring. Read-only — does NOT touch the
   * cached customer.credit_score column (that's the daily job's responsibility).
   */
  async getCreditRiskAssessment(request, reply) {
    const id = Number(request.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return reply.code(400).send({ success: false, message: 'Invalid customer id' });
    }
    const result = await assessAndLogCreditRisk(id);
    return reply.send({ success: true, data: result });
  }
}
