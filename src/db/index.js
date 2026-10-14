import mongoose from "mongoose";
import { DB_NAME } from "../constants.js";

const connectDB = async () => {
    
    try {
        console.log("Outside the DB function1");
        console.log("DB url--.",process.env.MONGODB_URI);
        
        let connectionUrl = process.env.MONGODB_URI;
        if (connectionUrl.includes("?")) {
            const [base, query] = connectionUrl.split("?");
            const cleanBase = base.endsWith("/") ? base.slice(0, -1) : base;
            if (cleanBase.endsWith(`/${DB_NAME}`)) {
                connectionUrl = `${cleanBase}?${query}`;
            } else {
                connectionUrl = `${cleanBase}/${DB_NAME}?${query}`;
            }
        } else {
            const cleanBase = connectionUrl.endsWith("/") ? connectionUrl.slice(0, -1) : connectionUrl;
            if (!cleanBase.endsWith(`/${DB_NAME}`)) {
                connectionUrl = `${cleanBase}/${DB_NAME}`;
            } else {
                connectionUrl = cleanBase;
            }
        }

        const connectionInstance = await mongoose.connect(connectionUrl)
        
        console.log(`\n MongoDB connected !! DB HOST: ${connectionInstance.connection.host}`);
    } catch (error) {
        console.log("MONGODB connection FAILED ", error);
        process.exit(1)
    }
}
export default connectDB