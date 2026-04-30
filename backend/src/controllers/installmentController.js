import installmentActionService from '../services/installmentActionService.js';
import { installmentActionSchema } from '../utils/validation.js';

export class InstallmentController {
  async listActions(request, reply) {
    const data = await installmentActionService.listActions(
      Number(request.params.id),
      request.user
    );
    return reply.send({ success: true, data });
  }

  async recordAction(request, reply) {
    const body = installmentActionSchema.parse(request.body);
    const data = await installmentActionService.recordAction(
      Number(request.params.id),
      body,
      request.user
    );
    return reply.code(201).send({ success: true, data, message: 'Action recorded' });
  }
}

export default new InstallmentController();
