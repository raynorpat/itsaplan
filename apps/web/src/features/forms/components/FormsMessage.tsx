export default function FormsMessage({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-1 py-24 text-center">
      <h1 className="text-base font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
