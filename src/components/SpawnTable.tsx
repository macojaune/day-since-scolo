const SpawnTable = ({
  data,
}: {
  data: { id: number; createdAt: string; tool?: string }[];
}) => (
  <table className="table-fixed">
    <thead>
      <tr className="border-b border-amber-100/70">
        <th className="text-amber-500 pr-4 border-r border-amber-100/25">
          Dernières rencontres
        </th>
        <th className="text-amber-500 pl-4">Arme</th>
      </tr>
    </thead>
    <tbody>
      {data.map((item, index: number) => {
        if (index === 0) return null;
        const date = new Date(item.createdAt);
        return (
          <tr className="border-b border-amber-100/25">
            <td className="text-white border-r pr-4 border-amber-100/25">
              Le{" "}
              {date.toLocaleString("fr-Fr", {
                timeZone: "America/New_York",
                day: "2-digit",
                month: "long",
                year: "numeric",
                hour: "numeric",
                minute: "numeric",
                hourCycle: "h24",
              })}
            </td>
            <td className="text-amber-300 pl-4">{item?.tool ?? "Digrain"}</td>
          </tr>
        );
      })}
    </tbody>
  </table>
);
export default SpawnTable;
