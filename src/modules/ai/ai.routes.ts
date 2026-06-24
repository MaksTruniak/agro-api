import { FastifyInstance } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function aiRoutes(fastify: FastifyInstance) {
    fastify.post('/v1/ai/chat', async (request, reply) => {
        const { messages, context } = request.body as {
            messages: { role: 'user' | 'assistant'; content: string }[];
            context?: { crops?: string; region?: string };
        };

        if (!messages?.length) {
            return reply.status(400).send({ error: 'messages is required' });
        }

        const systemPrompt = `Ти досвідчений агроном-консультант в Україні.
Фермер вирощує: ${context?.crops || 'не вказано'}.
Регіон: ${context?.region || 'не вказано'}.
Відповідай коротко і практично українською мовою, до 5 речень.
Якщо потрібні препарати — називай конкретно. Без зайвих вступів.`;

        const response = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1024,
            system: systemPrompt,
            messages,
        });

        return { reply: (response.content[0] as any).text };
    });
}