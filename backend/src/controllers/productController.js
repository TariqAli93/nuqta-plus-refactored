import { ProductService } from '../services/productService.js';
import { productSchema } from '../utils/validation.js';

const productService = new ProductService();

export class ProductController {
  async create(request, reply) {
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
