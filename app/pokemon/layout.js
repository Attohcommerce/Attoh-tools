import "./pokemon.css";

export const metadata = {
  title: "Attoh Pokémon",
  description: "Scraper · Importer · Store Doctor voor de Pokémon-store",
};

export const viewport = { themeColor: "#f6f4ef" };

// Eigen jasje voor de Pokémon-tool (07-11-2026): licht thema, eigen
// lettertype. Ligt over de donkere Attoh Tools-achtergrond heen (.pk is
// fixed full-screen met eigen achtergrond), net als de reisplanner.
// Login = de gewone Attoh Tools-login (middleware).
export default function PokemonLayout({ children }) {
  return (
    <div className="pk">
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700;800&family=JetBrains+Mono:wght@500;600&display=swap"
      />
      {children}
    </div>
  );
}
