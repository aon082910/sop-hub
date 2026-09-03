import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";

interface Guide {
  title: string;
  description: string;
}
interface Step {
  id: string;
  title: string;
  instruction: string;
  image_path: string | null;
}

export default function PublicGuide() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<{ guide: Guide; steps: Step[] } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${api.base}/public/guides/${slug}`)
      .then((r) => {
        if (!r.ok) throw new Error("Guide not found");
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [slug]);

  if (error) return <p style={{ padding: 40 }}>{error}</p>;
  if (!data) return <p style={{ padding: 40 }}>Loading...</p>;

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "40px 20px" }}>
      <h1>{data.guide.title}</h1>
      <p style={{ color: "var(--muted)" }}>{data.guide.description}</p>
      {data.steps.map((s, i) => (
        <div className="card" key={s.id}>
          <h2>
            Step {i + 1}: {s.title}
          </h2>
          <p>{s.instruction}</p>
          {s.image_path && <img style={{ maxWidth: "100%", borderRadius: 8 }} src={`${api.base}/uploads/${s.image_path}`} alt="" />}
        </div>
      ))}
    </div>
  );
}
