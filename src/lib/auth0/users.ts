// external dependencies
import * as randomstring from 'randomstring';
// local dependencies
import * as auth0requests from './requests';
import * as Objects from './auth-types';
import * as passphrases from './passphrases';


async function getBearerToken(): Promise<string> {
    const body = await auth0requests.getOauthToken();
    return body.access_token;
}


function verifyTenant(student: Objects.UserMetadata, tenant: string) {
    if (student.tenant !== tenant) {
        const invalidTenant: any = new Error('Invalid tenant');
        invalidTenant.statusCode = 404;
        invalidTenant.error = 'Not Found';
        invalidTenant.message = 'Userid with this tenant not found';
        invalidTenant.errorCode = 'inexistent_user';
        throw invalidTenant;
    }
}
function verifyRole(student: Objects.UserMetadata, role: Objects.UserRole) {
    if (student.role !== role) {
        const invalidUser: any = new Error('Invalid user role');
        invalidUser.statusCode = 404;
        invalidUser.error = 'Not Found';
        invalidUser.message = 'User with the specified userid and role not found';
        invalidUser.errorCode = 'inexistent_user';
        throw invalidUser;
    }
}


export async function getStudent(tenant: string, userid: string): Promise<Objects.Student> {
    try {
        const token = await getBearerToken();

        const response: Objects.User = await auth0requests.getUser(token, userid);

        const student = response.app_metadata;
        verifyTenant(student, tenant);
        verifyRole(student, 'student');

        return {
            id: response.user_id,
            username: response.username,
            last_login: response.last_login,
        };
    }
    catch (err) {
        if (err && err.response && err.response.body) {
            throw err.response.body;
        }
        else {
            throw err;
        }
    }
}


export async function getStudents(tenant: string): Promise<Objects.Student[]> {
    const token = await getBearerToken();

    const students: Objects.User[] = await auth0requests.getUsers(token, tenant);

    return students
        .filter((student) => {
            return student.app_metadata.tenant === tenant;
        })
        .map((student) => {
            return {
                id : student.user_id,
                username : student.username,
                last_login : student.last_login,
            };
        });
}


export async function getStudentsByUserId(tenant: string): Promise<{ [id: string]: Objects.Student }> {
    const students = await getStudents(tenant);

    const studentsIndexedById: {[id: string]: Objects.Student } = {};

    students.forEach((student) => {
        studentsIndexedById[student.id] = student;
    });

    return studentsIndexedById;
}


export async function countUsers(tenant: string): Promise<number> {
    const token = await getBearerToken();
    const usersCountsInfo: Objects.UsersInfo = await auth0requests.getUserCounts(token, tenant);
    return usersCountsInfo.total;
}


async function createUser(newUserDetails: Objects.NewUser): Promise<Objects.UserCreds> {
    const token = await getBearerToken();
    const user = await auth0requests.createUser(token, newUserDetails);
    return {
        id : user.user_id,
        username : user.username,
        password : newUserDetails.password,
    };
}

export function createStudent(tenant: string, username: string): Promise<Objects.UserCreds> {
    return createUser({
        email : username + '@do-not-require-emailaddresses-for-students.com',
        username,
        password : passphrases.generate(),
        verify_email : false,
        email_verified : true,
        connection : process.env.AUTH0_CONNECTION as string,
        app_metadata : {
            role : 'student',
            tenant,
        },
    });
}

export function createTeacher(tenant: string, username: string, email: string): Promise<Objects.UserCreds> {
    return createUser({
        email,
        username,
        password : randomstring.generate({ length : 12, readable : true }),
        verify_email : true,
        email_verified : false,
        connection : process.env.AUTH0_CONNECTION as string,
        app_metadata : {
            role : 'supervisor',
            tenant,
        },
    });
}



export async function deleteStudent(tenant: string, userid: string) {
    // will verify the tenant matches the student
    //   throwing an exception if there is a problem
    await getStudent(tenant, userid);

    const token = await getBearerToken();

    return auth0requests.deleteUser(token, userid);
}

export async function deleteTeacher(tenant: string, userid: string) {
    const token = await getBearerToken();
    return auth0requests.deleteUser(token, userid);
}


async function resetPassword(
    tenant: string,
    userid: string, password: string,
    token: string,
): Promise<Objects.UserCreds>
{
    // will verify the tenant matches the student
    //   throwing an exception if there is a problem
    await getStudent(tenant, userid);

    const user = await auth0requests.modifyUser(token, userid, { password });

    return {
        id : user.user_id,
        username : user.username,
        password,
    };
}


export async function resetStudentsPassword(tenant: string, userids: string[]): Promise<Objects.UserCreds[]>
{
    const password = passphrases.generate();

    const token = await getBearerToken();

    let backoffMs = 5;
    const MAX_BACKOFF_MS = 5000;

    const allCreds: Objects.UserCreds[] = [];

    // auth0 will reject a large number of concurrent requests, so
    //  we do this sequentially
    for (const userid of userids) {
        const creds = await resetPassword(tenant, userid, password, token);
        allCreds.push(creds);

        // auth0 rate-limits aggressively, so protect against
        //  large workloads by waiting increasingly long times
        //  for large requests
        await pause(backoffMs);
        backoffMs += 50;

        // set an upper limit for how long to wait between requests
        backoffMs = backoffMs > MAX_BACKOFF_MS ? MAX_BACKOFF_MS : backoffMs;
    }
    return allCreds;
}


function pause(delay: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, delay);
    });
}


export async function resetStudentPassword(tenant: string, userid: string): Promise<Objects.UserCreds> {
    const password = passphrases.generate();

    // will verify the tenant matches the student
    //   throwing an exception if there is a problem
    await getStudent(tenant, userid);

    const token = await getBearerToken();

    const modifications = { password };

    const user = await auth0requests.modifyUser(token, userid, modifications);

    return {
        id : user.user_id,
        username : user.username,
        password,
    };
}
