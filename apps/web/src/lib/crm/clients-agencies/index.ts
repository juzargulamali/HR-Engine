// Clients & Agencies: the shared server-side pieces. Part 2 (Excel import/export) calls these; it adds no matching or writing rules of its own.
//   normalise.ts  names, e-mails, countries, websites, roles   (same rules as the database's name_key / website_domain)
//   match.ts      findOrganisationMatches, planEmptyFieldUpdate
//   write.ts      createOrganisationWithContacts, updateOrganisationEmptyFields, prepareNewOrganisation
//   staff.ts      eligibleStaff, resolveOwnerByEmail
//   data.ts       loadDirectory, loadAccount, loadStaff   (server-only, read through the signed-in person's session)
export * from "./normalise";
export * from "./match";
export * from "./write";
export * from "./staff";
export * from "./directory";
export * from "./account";
export * from "./company";
export * from "./outreach";
export * from "./relationship";
