export default function BonDeCommande() {
  const produits = [
    { nom: "Fraises", quantite: "30 kg", prix: "3,00 €", total: "90 €" },
    { nom: "Mangues", quantite: "30 kg", prix: "3,00 €", total: "90 €" }
  ];

  const infosClient = {
    nom: "Adeline Marie",
    telephone: "+221 77 643 12 12",
    email: "Adeline.marie@gmail.com",
    adresse: "2829 cité ISRA Bel-Air, Dakar, Sénégal"
  };

  const infosSupplementaires = {
    dateCommande: "01/05/2025",
    dateLivraison: "04/05/2025",
    instructions: "Merci de livrer avant fin de journée.",
    paiement: "Direct debit - OWOO"
  };

  return (
    <div className="min-h-screen bg-gray-100 text-black px-8 py-10">
      <div className="max-w-3xl mx-auto bg-white rounded-xl shadow-lg p-8 relative">
        <button className="absolute top-4 right-4 text-2xl font-bold text-gray-400 hover:text-black">×</button>

        <h1 className="text-2xl font-bold mb-6">Commande #1234</h1>

        {/* Statut */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-yellow-400"></span>
            <span className="text-sm font-medium">En Préparation</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="font-semibold text-sm">Changer statut</label>
            <select className="border border-black rounded px-3 py-1 text-sm">
              <option>En Préparation</option>
              <option>En Attente</option>
              <option>Livré</option>
            </select>
          </div>
        </div>

        {/* Infos client */}
        <div className="mb-8">
          <h2 className="text-lg font-bold mb-2">Infos client</h2>
          <hr className="mb-4" />
          <p><strong>Nom</strong> : {infosClient.nom}</p>
          <p><strong>Téléphone</strong> : {infosClient.telephone}</p>
          <p><strong>Email</strong> : {infosClient.email}</p>
          <p><strong>Adresse</strong> : {infosClient.adresse}</p>
        </div>

        {/* Produits commandés */}
        <div className="mb-8">
          <h2 className="text-lg font-bold mb-2">Produits commandé</h2>
          <hr className="mb-4" />
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2">Produit</th>
                <th className="text-left py-2">Quantité</th>
                <th className="text-left py-2">Prix unitaire</th>
                <th className="text-left py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {produits.map((p) => (
                <tr key={p.nom} className="border-b">
                  <td className="py-2">{p.nom}</td>
                  <td>{p.quantite}</td>
                  <td>{p.prix}</td>
                  <td>{p.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-right mt-4 font-bold">Total Commande : 180 €</div>
        </div>

        {/* Infos supplémentaires */}
        <div className="mb-8">
          <h2 className="text-lg font-bold mb-2">Infos supplémentaires</h2>
          <hr className="mb-4" />
          <p><strong>Date de la commande</strong> : {infosSupplementaires.dateCommande}</p>
          <p><strong>Date de livraison souhaitée</strong> : {infosSupplementaires.dateLivraison}</p>
          <p><strong>Instructions</strong> : {infosSupplementaires.instructions}</p>
          <p><strong>Moyen de paiement</strong> : {infosSupplementaires.paiement}</p>
        </div>

        {/* Actions */}
        <div className="flex gap-4">
          <button className="bg-yellow-400 text-black px-6 py-2 rounded hover:bg-yellow-500 transition">Imprimer la commande</button>
          <button className="border border-black text-black px-6 py-2 rounded hover:bg-black hover:text-white transition">Envoyer un message</button>
        </div>
      </div>
    </div>
  );
}
