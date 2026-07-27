import { dolibarrFetch, dolibarrList } from "./dolibarrApi";

export async function getUsers() {
  return dolibarrList("/users");
}

export async function getUserById(id) {
  return dolibarrFetch(`/users/${id}`);
}

export async function getEmployees() {
  const users = await getUsers();
  return users.filter((u) => u.employee === "1");
}
