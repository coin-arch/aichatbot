import { useState } from "react";

const API_URL = "https://aichatbot-nflo.onrender.com";

const starterMessages = [
  {
    role: "assistant",
    content:
      "Hello! I'm your SSP Agarbatti support assistant. How can I help you today?",
  },
];

export default function App() {
  const [isOpen, setIsOpen] = useState(true);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState(starterMessages);
  const [isIngesting, setIsIngesting] = useState(false);
  const [isChatting, setIsChatting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [showAdmin, setShowAdmin] = useState(false);

  const quickQuestions = [
    "What are your main products?",
    "Where is your head office located?",
    "How can I contact support?",
    "What is your mission and vision?",
  ];

  async function handleIngest() {
    setIsIngesting(true);
    setStatusMessage("");

    try {
      const response = await fetch(`${API_URL}/api/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Ingestion failed.");

      setStatusMessage(`Updated successfully! ${data.uploadedCount} chunks indexed.`);
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setIsIngesting(false);
    }
  }

  async function handleAsk(event, overriddenQuestion = null) {
    if (event) event.preventDefault();
    const finalQuestion = (overriddenQuestion || question).trim();
    if (!finalQuestion) return;

    const userMessage = { role: "user", content: finalQuestion };
    setMessages((current) => [...current, userMessage]);
    setQuestion("");
    setIsChatting(true);

    try {
      const response = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: userMessage.content }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Chat failed.");

      setMessages((current) => [...current, { role: "assistant", content: data.answer }]);
    } catch (error) {
      setMessages((current) => [...current, { role: "assistant", content: `Error: ${error.message}` }]);
    } finally {
      setIsChatting(false);
    }
  }

  return (
    <div className="widget-root">
      {/* Floating Toggle Button */}
      <button className={`widget-button ${isOpen ? 'active' : ''}`} onClick={() => setIsOpen(!isOpen)}>
        {isOpen ? (
          <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2.5" fill="none"><path d="M18 6L6 18M6 6l12 12"/></svg>
        ) : (
          <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        )}
      </button>

      {/* Main Chat Window */}
      {isOpen && (
        <div className="chat-window">
          <div className="chat-header">
            <div className="header-info">
              <span className="dot"></span>
              <div>
                <h3>SSP Agarbatti</h3>
                <p>Support Assistant</p>
              </div>
            </div>
            <button className="admin-toggle" onClick={() => setShowAdmin(!showAdmin)} title="Admin Menu">
              ⚙️
            </button>
          </div>

          <div className="chat-body">
            {showAdmin && (
              <div className="admin-panel animate-slide">
                <p className="small-tag">Document Context Manager</p>
                <button className="primary-button mini" onClick={handleIngest} disabled={isIngesting}>
                  {isIngesting ? "Syncing..." : "Sync Policy Documents"}
                </button>
                {statusMessage && <p className="status-tip">{statusMessage}</p>}
              </div>
            )}

            <div className="messages">
              {messages.map((message, index) => (
                <div key={index} className="message-wrapper">
                  <div className={`message ${message.role}`}>
                    {message.role === 'assistant' && <span className="label">AI</span>}
                    <div className="text-content" dangerouslySetInnerHTML={{ 
                      __html: message.content.replace(/\n/g, '<br/>').replace(/\*\*(.*?)\*\*/g, '<b>$1</b>') 
                    }} />
                  </div>

                  {index === messages.length - 1 && message.role === "assistant" && !isChatting && (
                    <div className="suggestions">
                      {quickQuestions.map((q) => (
                        <button key={q} className="chip" onClick={() => handleAsk(null, q)} disabled={isChatting}>
                          {q}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {isChatting && (
                <div className="message assistant thinking">
                   <div className="dot-flashing"></div>
                </div>
              )}
            </div>
          </div>

          <div className="chat-footer">
            <form className="composer" onSubmit={handleAsk}>
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask us anything..."
                disabled={isChatting}
              />
              <button type="submit" disabled={isChatting || !question.trim()} className="send-btn">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
