// node/utils/idGenerator.js

function generateId() {
  const now = new Date();

  const yyyy = now.getFullYear();

  const mm = String(
    now.getMonth() + 1
  ).padStart(2, "0");

  const dd = String(
    now.getDate()
  ).padStart(2, "0");

  const hh = String(
    now.getHours()
  ).padStart(2, "0");

  const mi = String(
    now.getMinutes()
  ).padStart(2, "0");

  const ss = String(
    now.getSeconds()
  ).padStart(2, "0");

  const rand = Math.floor(
    Math.random() * 9000 + 1000
  );

  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}-${rand}`;
}

module.exports = generateId;