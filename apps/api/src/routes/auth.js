const express = require('express');
const { z } = require('zod');
const authService = require('../services/auth');
const { ValidationError, UnauthorizedError } = require('../lib/errors');

const router = express.Router();

const requestSchema = z.object({
  email: z.string().email()
});

const verifySchema = z.object({
  email: z.string().email(),
  code: z.string().min(4).max(12)
});

function parseBody(schema, payload) {
  try {
    return schema.parse(payload);
  } catch (err) {
    throw new ValidationError(err);
  }
}

router.post('/request-code', (req, res, next) => {
  try {
    const { email } = parseBody(requestSchema, req.body);
    const issued = authService.requestLoginCode(email);
    if (!issued) {
      throw new UnauthorizedError('Вход недоступен для этого e-mail');
    }
    const response = {
      success: true,
      expiresAt: issued.expiresAt
    };
    if (req.app.get('env') !== 'production') {
      response.debugCode = issued.code;
    }
    return res.json(response);
  } catch (err) {
    return next(err);
  }
});

router.post('/verify-code', (req, res, next) => {
  try {
    const { email, code } = parseBody(verifySchema, req.body);
    const session = authService.verifyLoginCode(email, code);
    if (!session) {
      throw new UnauthorizedError('Неверный или просроченный код');
    }
    authService.attachSessionCookie(res, session);
    return res.json({
      authenticated: true,
      user: { email: session.email },
      expiresAt: session.expiresAt
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/session', (req, res) => {
  const sessionId = authService.parseSessionIdFromRequest(req);
  if (!sessionId) {
    authService.clearSessionCookie(res);
    return res.json({ authenticated: false });
  }
  const session = authService.touchSession(sessionId);
  if (!session) {
    authService.clearSessionCookie(res);
    return res.json({ authenticated: false });
  }
  authService.attachSessionCookie(res, session);
  return res.json({
    authenticated: true,
    user: { email: session.email },
    expiresAt: session.expiresAt
  });
});

router.post('/logout', (req, res) => {
  const sessionId = authService.parseSessionIdFromRequest(req);
  if (sessionId) {
    authService.destroySession(sessionId);
  }
  authService.clearSessionCookie(res);
  return res.status(204).send();
});

module.exports = router;
