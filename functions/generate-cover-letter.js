import OpenAI from 'openai';

const punycode = require('punycode');

const openai = new OpenAI({
  apiKey: process.env['OPENAI_API_KEY'],
});

// Rate limiting setup
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 5;
const requestLog = new Map();

function checkRateLimit(ip) {
    const now = Date.now();
    const userRequests = requestLog.get(ip) || [];
    
    // Remove requests outside the window
    const recentRequests = userRequests.filter(time => time > now - RATE_LIMIT_WINDOW);
    
    if (recentRequests.length >= MAX_REQUESTS_PER_WINDOW) {
        return false;
    }
    
    recentRequests.push(now);
    requestLog.set(ip, recentRequests);
    return true;
}

exports.handler = async function(event, context) {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    const clientIP = event.headers['client-ip'] || event.headers['x-forwarded-for'];
    if (!checkRateLimit(clientIP)) {
        return {
            statusCode: 429,
            headers,
            body: JSON.stringify({ error: 'Too many requests. Please try again later.' })
        };
    }

    try {
        const { resume, coverLetter, jobDescription } = JSON.parse(event.body);

        if (!resume || !coverLetter || !jobDescription) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Missing required fields' })
            };
        }

        const prompt = `
            Task: Create a personalized cover letter based on the provided resume, cover letter template, and job description.

            Resume:
            ${resume}

            Cover Letter Template:
            ${coverLetter}

            Job Description:
            ${jobDescription}

            Instructions:
            1. Maintain the professional tone and basic structure of the template
            2. Incorporate relevant keywords and phrases from the job description naturally
            3. Highlight specific experiences from the resume that directly match the job requirements
            4. Demonstrate understanding of the company's needs and how the candidate's skills address them
            5. Keep the letter concise and focused (around 300-400 words)
            6. Maintain any personal style elements from the original cover letter
            7. Include a strong opening that hooks the reader
            8. End with a clear call to action

            Additional Guidelines:
            - Ensure the letter flows naturally and doesn't feel like a template
            - Make specific references to the company and position
            - Focus on achievements and results rather than just responsibilities
            - Show enthusiasm and genuine interest in the role
            - Maintain professionalism throughout

            Please write the complete cover letter now:`;

        const completion = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview",
            messages: [
                {
                    role: "system",
                    content: "You are an expert career counselor and professional writer specializing in creating compelling cover letters."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.7,
            max_tokens: 1500,
            presence_penalty: 0.1,
            frequency_penalty: 0.1,
        });
        console.log(completion);
        const generatedCoverLetter = completion.choices[0].message.content.trim();

        // Post-processing to ensure proper formatting
        const formattedCoverLetter = generatedCoverLetter
            .replace(/\n{3,}/g, '\n\n') // Remove excessive line breaks
            .trim();

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                coverLetter: formattedCoverLetter,
                metadata: {
                    model: "gpt-4-turbo-preview",
                    tokens: completion.usage.total_tokens,
                    timestamp: new Date().toISOString()
                }
            })
        };

    } catch (error) {
        console.error('Error:', error);

        // Handle different types of errors
        if (error.response) {
            // OpenAI API error
            return {
                statusCode: error.response.status,
                headers,
                body: JSON.stringify({
                    error: 'AI service error',
                    message: error.response.data.error.message
                })
            };
        } else if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
            // Network error
            return {
                statusCode: 503,
                headers,
                body: JSON.stringify({
                    error: 'Service temporarily unavailable',
                    message: 'Please try again later'
                })
            };
        } else {
            // Generic error
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    error: 'Internal server error',
                    message: 'An unexpected error occurred'
                })
            };
        }
    }
};