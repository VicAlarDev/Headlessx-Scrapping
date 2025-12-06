/**
 * Gemini AI Service v1.0.0
 * Integration with Google Gemini API for intelligent data extraction
 */

const config = require('../config');
const { logger, generateRequestId } = require('../utils/logger');

class GeminiService {
    constructor() {
        this.apiKey = process.env.GEMINI_API_KEY;
        this.model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
        this.client = null;
        this.initialized = false;
    }

    /**
     * Initialize the Gemini client
     */
    async initialize() {
        if (this.initialized) return;

        if (!this.apiKey) {
            throw new Error('GEMINI_API_KEY is not configured. Please add it to your .env file.');
        }

        try {
            const { GoogleGenAI } = require('@google/genai');
            this.client = new GoogleGenAI({ apiKey: this.apiKey });
            this.initialized = true;
            logger.info('gemini_init', 'Gemini AI service initialized successfully');
        } catch (error) {
            logger.error('gemini_init', 'Failed to initialize Gemini AI', { error: error.message });
            throw error;
        }
    }

    /**
     * Extract structured product data from HTML content
     */
    async extractProducts(htmlContent, options = {}) {
        const requestId = generateRequestId();
        await this.initialize();

        const {
            maxProducts = 50,
            language = 'es',
            includeImages = true,
            site = 'amazon'
        } = options;

        const systemPrompt = language === 'es'
            ? `Eres un experto en extracción de datos de productos de ${site}. 
               Analiza el HTML proporcionado y extrae información de productos.
               Responde SOLO con un JSON válido, sin markdown ni explicaciones.`
            : `You are an expert in extracting product data from ${site}. 
               Analyze the provided HTML and extract product information.
               Respond ONLY with valid JSON, no markdown or explanations.`;

        // Amazon-specific hints for the AI
        let amazonHints = '';
        if (site === 'amazon') {
            amazonHints = language === 'es'
                ? `
               IMPORTANTE para Amazon:
               - El nombre y URL del producto están en: <a class="a-link-normal s-line-clamp-2..."> con <h2><span>NOMBRE</span></h2>
               - El href del <a> es la URL del producto (agregar https://www.amazon.com si es relativa)
               - El precio actual está en: <span class="a-price"><span class="a-offscreen">$369.99</span>
               - El precio original/típico (tachado) está en: <span class="a-price a-text-price" data-a-strike="true"><span class="a-offscreen">$1,999.00</span>
               - La imagen está en: <img class="s-image" src="...">
               - El rating está en elementos con aria-label que contiene "stars" o "estrellas"
               - Si hay precio original mayor al actual, calcula el descuento como porcentaje
               `
                : `
               IMPORTANT for Amazon:
               - Product name and URL are in: <a class="a-link-normal s-line-clamp-2..."> with <h2><span>NAME</span></h2>
               - The href of <a> is the product URL (add https://www.amazon.com if relative)
               - Current price is in: <span class="a-price"><span class="a-offscreen">$369.99</span>
               - Original/typical price (strikethrough) is in: <span class="a-price a-text-price" data-a-strike="true"><span class="a-offscreen">$1,999.00</span>
               - Image is in: <img class="s-image" src="...">
               - Rating is in elements with aria-label containing "stars"
               - If original price is higher than current, calculate discount as percentage
               `;
        }

        const extractionPrompt = language === 'es'
            ? `Extrae hasta ${maxProducts} productos del siguiente HTML de ${site}.
               ${amazonHints}
               Para cada producto extrae:
               - name: nombre del producto (string)
               - price: precio numérico sin símbolos (number o null)
               - currency: moneda (string, ej: "USD", "EUR")
               - originalPrice: precio original si hay descuento (number o null)
               - discount: porcentaje de descuento si existe (number o null)
               - productUrl: URL completa del producto, debe empezar con https:// (string)
               ${includeImages ? '- imageUrl: URL de la imagen principal (string)' : ''}
               - rating: calificación de 0 a 5 (number o null)
               - reviewCount: número de reseñas (number o null)
               - isPrime: si tiene Prime/envío gratis (boolean)
               - seller: vendedor si está disponible (string o null)
               - availability: disponibilidad (string o null)
               
               Responde con este formato JSON exacto:
               {
                 "products": [...],
                 "totalFound": number
               }`
            : `Extract up to ${maxProducts} products from the following ${site} HTML.
               ${amazonHints}
               For each product extract:
               - name: product name (string)
               - price: numeric price without symbols (number or null)
               - currency: currency (string, e.g.: "USD", "EUR")
               - originalPrice: original price if discounted (number or null)
               - discount: discount percentage if exists (number or null)
               - productUrl: full product URL, must start with https:// (string)
               ${includeImages ? '- imageUrl: main image URL (string)' : ''}
               - rating: rating from 0 to 5 (number or null)
               - reviewCount: number of reviews (number or null)
               - isPrime: has Prime/free shipping (boolean)
               - seller: seller if available (string or null)
               - availability: availability (string or null)
               
               Respond with this exact JSON format:
               {
                 "products": [...],
                 "totalFound": number
               }`;

        try {
            logger.info(requestId, 'Sending content to Gemini for extraction...');

            const response = await this.client.models.generateContent({
                model: this.model,
                contents: `${systemPrompt}\n\n${extractionPrompt}\n\nHTML:\n${htmlContent}`,
                config: {
                    maxOutputTokens: 8192,
                    temperature: 0.1,
                    topP: 0.8
                }
            });

            const responseText = response.text;
            logger.info(requestId, 'Received response from Gemini');

            // Parse JSON response
            let jsonResponse;
            try {
                // Try to extract JSON from response (handle markdown code blocks)
                let jsonStr = responseText;
                if (jsonStr.includes('```json')) {
                    jsonStr = jsonStr.split('```json')[1].split('```')[0];
                } else if (jsonStr.includes('```')) {
                    jsonStr = jsonStr.split('```')[1].split('```')[0];
                }
                jsonResponse = JSON.parse(jsonStr.trim());
            } catch (parseError) {
                logger.warn(requestId, 'Failed to parse Gemini response as JSON', {
                    error: parseError.message,
                    responsePreview: responseText.substring(0, 500)
                });
                throw new Error('Gemini response was not valid JSON');
            }

            logger.info(requestId, `Extracted ${jsonResponse.products?.length || 0} products via Gemini`);

            return {
                success: true,
                ...jsonResponse,
                metadata: {
                    model: this.model,
                    requestId,
                    tokenCount: response.usageMetadata?.totalTokenCount || null
                }
            };
        } catch (error) {
            logger.error(requestId, 'Gemini extraction failed', { error: error.message });
            throw error;
        }
    }

    /**
     * Generic content analysis with custom prompt
     */
    async analyzeContent(content, customPrompt, options = {}) {
        const requestId = generateRequestId();
        await this.initialize();

        const {
            maxTokens = 4096,
            temperature = 0.3,
            responseFormat = 'json'
        } = options;

        try {
            logger.info(requestId, 'Sending content to Gemini for analysis...');

            const response = await this.client.models.generateContent({
                model: this.model,
                contents: `${customPrompt}\n\nContent:\n${content}`,
                config: {
                    maxOutputTokens: maxTokens,
                    temperature,
                    topP: 0.9
                }
            });

            const responseText = response.text;

            if (responseFormat === 'json') {
                let jsonStr = responseText;
                if (jsonStr.includes('```json')) {
                    jsonStr = jsonStr.split('```json')[1].split('```')[0];
                } else if (jsonStr.includes('```')) {
                    jsonStr = jsonStr.split('```')[1].split('```')[0];
                }
                return {
                    success: true,
                    data: JSON.parse(jsonStr.trim()),
                    metadata: {
                        model: this.model,
                        requestId,
                        tokenCount: response.usageMetadata?.totalTokenCount || null
                    }
                };
            }

            return {
                success: true,
                data: responseText,
                metadata: {
                    model: this.model,
                    requestId,
                    tokenCount: response.usageMetadata?.totalTokenCount || null
                }
            };
        } catch (error) {
            logger.error(requestId, 'Gemini analysis failed', { error: error.message });
            throw error;
        }
    }

    /**
     * Check if Gemini is configured and available
     */
    isConfigured() {
        return !!this.apiKey;
    }

    /**
     * Get service status
     */
    getStatus() {
        return {
            configured: this.isConfigured(),
            initialized: this.initialized,
            model: this.model,
            apiKeyPresent: !!this.apiKey
        };
    }
}

// Export singleton instance
module.exports = new GeminiService();
