import { Response } from 'express';
import { AuthRequest } from '../types/index.js';
import { QuotationService } from '../services/quotation.js';
import { QuotationPdfService } from '../services/quotationPdf.js';
import { AppError } from '../utils/error.js';

export class QuotationController {
  static async create(req: AuthRequest, res: Response) {
    const companyId = req.companyId!;
    const userId = req.user?.userId;
    const ipAddress = req.ip;

    const quotation = await QuotationService.create(companyId, req.body, userId, ipAddress);

    return res.status(201).json({
      message: 'Quotation created successfully',
      data: quotation
    });
  }

  static async update(req: AuthRequest, res: Response) {
    const companyId = req.companyId!;
    const quotationId = req.params.id as string;
    const userId = req.user?.userId;
    const ipAddress = req.ip;

    const quotation = await QuotationService.update(companyId, quotationId, req.body, userId, ipAddress);

    return res.json({
      message: 'Quotation updated successfully',
      data: quotation
    });
  }

  static async getById(req: AuthRequest, res: Response) {
    const companyId = req.companyId!;
    const quotationId = req.params.id as string;

    const quotation = await QuotationService.getById(companyId, quotationId);

    return res.json({
      message: 'Quotation retrieved successfully',
      data: quotation
    });
  }

  static async list(req: AuthRequest, res: Response) {
    const companyId = req.companyId!;
    const result = await QuotationService.list(companyId, req.query as any);

    return res.json({
      message: 'Quotations retrieved successfully',
      data: result.quotations,
      pagination: result.pagination,
      summary: result.summary
    });
  }

  static async delete(req: AuthRequest, res: Response) {
    const companyId = req.companyId!;
    const quotationId = req.params.id as string;

    await QuotationService.delete(companyId, quotationId);

    return res.json({
      message: 'Quotation deleted successfully'
    });
  }

  static async send(req: AuthRequest, res: Response) {
    const companyId = req.companyId!;
    const quotationId = req.params.id as string;
    const userId = req.user?.userId;
    const ipAddress = req.ip;

    const quotation = await QuotationService.send(companyId, quotationId, userId, ipAddress);

    return res.json({
      message: 'Quotation marked as sent',
      data: quotation
    });
  }

  static async accept(req: AuthRequest, res: Response) {
    const companyId = req.companyId!;
    const quotationId = req.params.id as string;
    const userId = req.user?.userId;
    const ipAddress = req.ip;

    const quotation = await QuotationService.accept(companyId, quotationId, userId, ipAddress);

    return res.json({
      message: 'Quotation marked as accepted',
      data: quotation
    });
  }

  static async reject(req: AuthRequest, res: Response) {
    const companyId = req.companyId!;
    const quotationId = req.params.id as string;
    const { reason } = req.body || {};
    const userId = req.user?.userId;
    const ipAddress = req.ip;

    const quotation = await QuotationService.reject(companyId, quotationId, reason, userId, ipAddress);

    return res.json({
      message: 'Quotation marked as rejected',
      data: quotation
    });
  }

  static async cancel(req: AuthRequest, res: Response) {
    const companyId = req.companyId!;
    const quotationId = req.params.id as string;
    const { reason } = req.body || {};
    const userId = req.user?.userId;
    const ipAddress = req.ip;

    const quotation = await QuotationService.cancel(companyId, quotationId, reason, userId, ipAddress);

    return res.json({
      message: 'Quotation cancelled',
      data: quotation
    });
  }

  static async duplicate(req: AuthRequest, res: Response) {
    const companyId = req.companyId!;
    const quotationId = req.params.id as string;
    const userId = req.user?.userId;
    const ipAddress = req.ip;

    const quotation = await QuotationService.duplicate(companyId, quotationId, userId, ipAddress);

    return res.status(201).json({
      message: 'Quotation duplicated successfully',
      data: quotation
    });
  }

  static async convertToInvoice(req: AuthRequest, res: Response) {
    const companyId = req.companyId!;
    const quotationId = req.params.id as string;
    const userId = req.user?.userId;
    const ipAddress = req.ip;

    const invoice = await QuotationService.convertToInvoice(companyId, quotationId, userId, ipAddress);

    return res.status(201).json({
      message: 'Quotation converted to Tax Invoice successfully',
      data: invoice
    });
  }

  static async renderPdf(req: AuthRequest, res: Response) {
    const companyId = req.companyId!;
    const quotationId = req.params.id as string;

    const { buffer, fileName } = await QuotationPdfService.render(companyId, quotationId);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.setHeader('Content-Length', buffer.length);
    return res.send(buffer);
  }
}
