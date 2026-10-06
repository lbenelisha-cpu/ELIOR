export function requireLivePrice(stream, now = Date.now(), maxAgeMs = 90000) {
  const price = Number(stream?.lastPrice);
  const eventAt = Date.parse(stream?.lastEventAt);
  const age = now - eventAt;
  if (stream?.status !== 'connected' || !Number.isFinite(price) || price <= 0 ||
      !Number.isFinite(age) || age < -5000 || age > maxAgeMs) {
    throw new Error('Fresh connected Binance price required; entry evaluation paused');
  }
  return price;
}
