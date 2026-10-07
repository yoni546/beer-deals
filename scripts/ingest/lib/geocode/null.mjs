/**
 * The provider that refuses.
 *
 * It is the default, and it answers null for every branch. Nothing is written, the
 * admin count of unlocated branches stays where it is, and "closest to me" keeps
 * saying it does not know where the branches are.
 *
 * That is the correct behaviour for an unconfigured deployment. The alternative --
 * falling back to the branch's town centre and calling it the shop -- would put
 * thousands of plausible, wrong, undetectable positions in the table, and a person
 * standing outside the wrong supermarket has been lied to by this app.
 */
export const nullProvider = () => ({
  name: "null",
  configured: false,
  note: "no geocoder configured (set GEOCODER in the target's env file)",
  async geocode() {
    return null;
  },
});
