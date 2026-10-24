import { afterEach, expect, it } from "vitest";
import { sendMail } from "@/lib/mail";

afterEach(() => {
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
});

it("se l'SMTP non risponde dà un errore chiaro invece di 'errore del server'", async () => {
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = "1";
  await expect(sendMail("a@test.it", "x", "y")).rejects.toMatchObject({
    status: 502,
    message: "Non sono riuscito a inviare l'email. Riprova tra qualche minuto.",
  });
});
