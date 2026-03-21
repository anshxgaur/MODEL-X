from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
from dotenv import load_dotenv
from groq import Groq
import os

load_dotenv()

app = Flask(__name__)
CORS(app)

client = Groq(api_key=os.environ.get("VITE_GROQ_API_KEY"))

SYSTEM_PROMPT = "You are NOVA, an advanced AI assistant with a sleek futuristic personality. Be helpful, concise, and slightly futuristic in tone."

@app.route('/api/sonnet', methods=['POST'])
def handle_task():
    data = request.json
    user_prompt = data.get("prompt", "")

    def generate():
        stream = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            max_tokens=1024,
            stream=True,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt}
            ]
        )
        for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta

    return Response(stream_with_context(generate()), mimetype='text/plain')

@app.route('/api/chat', methods=['POST'])
def handle_chat():
    data = request.json
    messages = data.get("messages", [])

    def generate():
        stream = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            max_tokens=1024,
            stream=True,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                *messages
            ]
        )
        for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta

    return Response(stream_with_context(generate()), mimetype='text/plain')

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "NOVA backend online ⚡"})

if __name__ == '__main__':
    app.run(port=5000, debug=True)