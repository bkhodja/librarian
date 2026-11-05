const express = require('express');
const router = express.Router();
const libraryChat = require('../services/libraryChat');

/** Is the model up, and how much of the library has a difficulty profile? */
router.get('/status', async (req, res) => {
  try {
    res.json(await libraryChat.status());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/conversations', (req, res) => {
  try {
    res.json(libraryChat.listConversations());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/conversations/:id', (req, res) => {
  try {
    const conversation = libraryChat.getConversation(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'No such conversation' });
    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/conversations/:id', (req, res) => {
  try {
    if (!libraryChat.deleteConversation(req.params.id)) {
      return res.status(404).json({ error: 'No such conversation' });
    }
    res.json({ deleted: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Send a message; the answer comes back as server-sent events on this
 * response (meta, token…, done — or error). A POST rather than EventSource,
 * which can only GET.
 */
router.post('/messages', async (req, res) => {
  const message = (req.body?.message || '').trim();
  if (message.length < 2) {
    return res.status(400).json({ error: 'Ask a question' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });

  // Stop the model when the reader closes the panel or presses Stop.
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });

  const emit = (event, data) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await libraryChat.ask(
      { conversationId: req.body.conversationId, message },
      emit,
      { signal: controller.signal }
    );
  } catch (error) {
    emit('error', { error: error.message });
  } finally {
    res.end();
  }
});

module.exports = router;
