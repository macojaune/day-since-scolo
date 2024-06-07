import { useQuery, useMutation } from "@tanstack/react-query";
import axios from "axios";
import { useState } from "react";
import {
  SignInButton,
  SignOutButton,
  SignedIn,
  SignedOut,
  useUser,
} from "@clerk/clerk-react";

const BetForm = ({ spawn }) => {
  const { isLoaded, user } = useUser();
  const totalCredits = 3; //todo fetch userCredits
  const [date, setDate] = useState(new Date());
  const [success, setSuccess] = useState<null | boolean>(null);
  const { data } = useQuery({
    queryKey: ["totalCredits"],
    queryFn: async () =>
      axios
        .get(import.meta.env.VITE_API_URL + "/credits/" + user?.id)
        .then((res) => res.data),
  });

  const { mutateAsync, isPending } = useMutation({
    mutationKey: ["bet"],
    mutationFn: async () =>
      axios
        .post(import.meta.env.VITE_API_URL + "/bet", {
          userId: user?.id,
          date,
          credits: totalCredits,
          spawnId: spawn.id,
        })
        .then((res) => res.data),
    onSuccess(data, variables, context) {
      setSuccess(true);
    },
  });

  if (!isLoaded) return null;

  const handleBet = async () => {
    await mutateAsync();
  };

  return (
    <div className="bg-yellow-400 p-4 rounded-md flex flex-col">
      <h2 className="text-3xl text-start">Parie sur la prochaine rencontre</h2>
      <SignedOut>
        <SignInButton mode="modal">
          <button>Se connecter</button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <div className="flex flex-col items-center gap-3 justify-between">
          <div className=" flex flex-row gap-2 items-baseline w-full">
            <span>Connecté·e en tant que @{user?.username}</span>
            <SignOutButton>
              <button className="text-sm text-red-800 hover:font-bold">
                Déconnexion
              </button>
            </SignOutButton>
          </div>
          <div>
            <p>Choisis une date</p>
            <input
              type="date"
              className=""
              min={new Date().toISOString().substring(0, 10)}
              value={date.toISOString().substring(0, 10)}
              onChange={(e) => setDate(new Date(e.target.value))}
              required
            />
          </div>
          <div className="flex flex-col px-4 items-center">
            <span className="text-sm italic">
              {totalCredits} crédits disponibles
            </span>
            <button
              onClick={handleBet}
              className="bg-black hover:bg-gray-800 px-8 py-4 rounded-md text-white w-fit"
            >
              {isPending ? (
                "Patientons…"
              ) : (
                <>
                  <b className="font-semibold">Miser</b>{" "}
                  <i className="italic">(3 crédits)</i>
                </>
              )}
            </button>
          </div>
        </div>
      </SignedIn>
    </div>
  );
};
export default BetForm;
