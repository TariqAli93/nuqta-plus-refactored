import { ProductService } from '../services/productService.js';
import { productSchema, PRODUCT_FORBIDDEN_STOCK_KEYS } from '../utils/validation.js';
import { ValidationError } from '../utils/errors.js';

const productService = new ProductService();

// Stock fields are managed exclusively through the inventory movement API.
// Reject the payload before it reaches the service layer so the client gets
// a stable, documented error code.
function rejectStockKeys(body) {
  if (!body || typeof body !== 'object') return;
  const offending = PRODUCT_FORBIDDEN_STOCK_KEYS.filter((k) =>
    Object.prototype.hasOwnProperty.call(body, k)
  );
  if (offending.length > 0) {
    throw new ValidationError(
      `Stock cannot be modified through product endpoints. Use the inventory movement API instead. Offending fields: ${offending.join(', ')}`,
      'STOCK_UPDATE_NOT_ALLOWED_ON_PRODUCT'
    );
  }
}

export class ProductController {
  async create(request, reply) {
    rejectStockKeys(request.body);
    const validatedData = productSchema.parse(request.body);
    const product = await productService.create(validatedData, request.user.id);
    return reply.code(201).send({
      success: true,
      data: product,
      message: 'Product created successfully',
    });
  }

  async getAll(request, reply) {
    const result = await productService.getAll(request.query);
    return reply.send({
      success: true,
      data: result.data,
      meta: result.meta,
    });
  }

  async getById(request, reply) {
    const product = await productService.getById(request.params.id);
    return reply.send({
      success: true,
      data: product,
    });
  }

  async update(request, reply) {
    rejectStockKeys(request.body);
    const validatedData = productSchema.partial().parse(request.body);
    const product = await productService.update(request.params.id, validatedData);
    return reply.send({
      success: true,
      data: product,
      message: 'Product updated successfully',
    });
  }

  async delete(request, reply) {
    const result = await productService.delete(request.params.id);
    return reply.send({
      success: true,
      message: result.message,
    });
  }

  async getLowStock(request, reply) {
    const products = await productService.getLowStock();
    return reply.send({
      success: true,
      data: products,
    });
  }
}
