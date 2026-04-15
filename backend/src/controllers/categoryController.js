import { CategoryService } from '../services/categoryService.js';
import { categorySchema } from '../utils/validation.js';

const categoryService = new CategoryService();

export class CategoryController {
  async create(request, reply) {
    const validatedData = categorySchema.parse(request.body);
    const category = await categoryService.create(validatedData);
    return reply.code(201).send({
      success: true,
      data: category,
      message: 'Category created successfully',
    });
  }

  async getAll(request, reply) {
    const result = await categoryService.getAll(request.query);
    return reply.send({
      success: true,
      data: result.data,
      meta: result.meta,
    });
  }

  async getById(request, reply) {
    const category = await categoryService.getById(request.params.id);
    return reply.send({
      success: true,
      data: category,
    });
  }

  async update(request, reply) {
    const validatedData = categorySchema.partial().parse(request.body);
    const category = await categoryService.update(request.params.id, validatedData);
    return reply.send({
      success: true,
      data: category,
      message: 'Category updated successfully',
    });
  }

  async delete(request, reply) {
    const result = await categoryService.delete(request.params.id);
    return reply.send({
      success: true,
      message: result.message,
    });
  }
}
