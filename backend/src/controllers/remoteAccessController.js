import * as remoteAccessService from '../services/remoteAccessService.js';

export class RemoteAccessController {
  async getStatus(request, reply) {
    try {
      const status = await remoteAccessService.getStatus();
      return reply.send({ success: true, data: status });
    } catch (err) {
      request.log.error({ err }, 'remote-access getStatus failed');
      return reply.code(500).send({ success: false, error: err.message });
    }
  }

  async enable(request, reply) {
    try {
      const status = await remoteAccessService.enable();
      return reply.send({ success: true, data: status });
    } catch (err) {
      request.log.error({ err }, 'remote-access enable failed');
      const code = err.code === 'CLOUDFLARED_MISSING' ? 503 : 500;
      return reply.code(code).send({
        success: false,
        error: err.message,
        ...(err.code ? { code: err.code } : {}),
      });
    }
  }

  async disable(request, reply) {
    try {
      const status = await remoteAccessService.disable();
      return reply.send({ success: true, data: status });
    } catch (err) {
      request.log.error({ err }, 'remote-access disable failed');
      return reply.code(500).send({ success: false, error: err.message });
    }
  }
}

export default new RemoteAccessController();
